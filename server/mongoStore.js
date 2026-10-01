const { MongoClient } = require('mongodb');

class MongoStore {
  constructor() {
    this.client = null;
    this.db = null;
    this.users = null;
    this.transactions = null;
    this.counters = null;
  }

  async connect(uri, databaseName = 'digiswara') {
    if (this.db) return this.db;

    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });
    await client.connect();
    const db = client.db(databaseName);
    const users = db.collection('users');
    const transactions = db.collection('lynk_transactions');

    await Promise.all([
      users.createIndexes([
        { key: { id: 1 }, name: 'uniq_user_id', unique: true },
        { key: { username: 1 }, name: 'uniq_username', unique: true },
        { key: { email: 1 }, name: 'uniq_email', unique: true },
        {
          key: { lynk_ref_id: 1 },
          name: 'uniq_lynk_ref_id',
          unique: true,
          partialFilterExpression: { lynk_ref_id: { $type: 'string' } }
        }
      ]),
      transactions.createIndex({ ref_id: 1 }, { name: 'uniq_transaction_ref_id', unique: true })
    ]);

    this.client = client;
    this.db = db;
    this.users = users;
    this.transactions = transactions;
    this.counters = db.collection('counters');
    const highestUser = await users.findOne({}, { sort: { id: -1 }, projection: { id: 1 } });
    if (highestUser) {
      await this.counters.updateOne(
        { _id: 'users' },
        { $max: { seq: highestUser.id } },
        { upsert: true }
      );
    }
    return db;
  }

  async migrateFromSqlite(sqliteDb) {
    const queryAll = (sql) => new Promise((resolve, reject) => {
      sqliteDb.all(sql, (err, rows) => (err ? reject(err) : resolve(rows || [])));
    });
    const [users, transactions] = await Promise.all([
      queryAll('SELECT id, username, email, password, lynk_ref_id, is_active, created_at FROM users'),
      queryAll('SELECT ref_id, message_id, email, customer_name, product_title, amount, status, is_paid, received_at FROM lynk_transactions')
    ]);

    if (users.length) {
      await this.users.bulkWrite(users.map((user) => ({
        updateOne: {
          filter: { id: user.id },
          update: { $setOnInsert: user },
          upsert: true
        }
      })), { ordered: true });
      await this.counters.updateOne(
        { _id: 'users' },
        { $max: { seq: users.reduce((max, user) => Math.max(max, user.id || 0), 0) } },
        { upsert: true }
      );
    }

    if (transactions.length) {
      await this.transactions.bulkWrite(transactions.map((transaction) => ({
        updateOne: {
          filter: { ref_id: transaction.ref_id },
          update: { $setOnInsert: transaction },
          upsert: true
        }
      })), { ordered: true });
    }

    return { users: users.length, transactions: transactions.length };
  }

  async nextUserId() {
    const counter = await this.counters.findOneAndUpdate(
      { _id: 'users' },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: 'after', includeResultMetadata: false }
    );
    if (!counter || !Number.isSafeInteger(counter.seq)) {
      throw new Error('MongoDB gagal menghasilkan ID akun.');
    }
    return counter.seq;
  }

  findUserByLogin(username, email) {
    return this.users.findOne({
      $or: [{ username }, { email }]
    });
  }

  findUserById(id) {
    return this.users.findOne(
      { id },
      { projection: { _id: 0, id: 1, username: 1, email: 1, created_at: 1 } }
    );
  }

  findUserByRef(refId) {
    return this.users.findOne({ lynk_ref_id: refId });
  }

  findUserByEmail(email) {
    return this.users.findOne({ email });
  }

  findUserByUsername(username) {
    return this.users.findOne({ username }, { projection: { _id: 1 } });
  }

  async createUser({ username, email, password, refId }) {
    const user = {
      id: await this.nextUserId(),
      username,
      email,
      password,
      lynk_ref_id: refId,
      is_active: 1,
      created_at: new Date().toISOString()
    };
    await this.users.insertOne(user);
    return user;
  }

  async updateCredentials(id, password, refId) {
    const result = await this.users.updateOne(
      { id },
      { $set: { password, lynk_ref_id: refId } }
    );
    if (!result.matchedCount) throw new Error('Akun tidak ditemukan saat memperbarui kredensial.');
  }

  async restoreCredentials(id, password, refId) {
    const update = refId == null
      ? { $set: { password }, $unset: { lynk_ref_id: '' } }
      : { $set: { password, lynk_ref_id: refId } };
    await this.users.updateOne({ id }, update);
  }

  async deleteUser(id) {
    await this.users.deleteOne({ id });
  }

  async close() {
    if (this.client) await this.client.close();
    this.client = null;
    this.db = null;
    this.users = null;
    this.transactions = null;
    this.counters = null;
  }

  findTransactionByRef(refId) {
    return this.transactions.findOne({ ref_id: refId });
  }

  async upsertTransaction(tx) {
    const document = {
      ref_id: tx.refId,
      message_id: tx.messageIdCandidates[0] || null,
      email: tx.email,
      customer_name: tx.name,
      product_title: tx.productTitle,
      amount: tx.amount,
      status: tx.statusRaw,
      is_paid: tx.isPaid ? 1 : 0,
      received_at: new Date().toISOString()
    };
    await this.transactions.updateOne(
      { ref_id: tx.refId },
      { $set: document },
      { upsert: true }
    );
  }
}

module.exports = new MongoStore();