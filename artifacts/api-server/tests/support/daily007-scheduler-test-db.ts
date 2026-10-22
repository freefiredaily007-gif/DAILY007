export const daily007SchedulerTestDb = {
  queryCalls: 0,
  connectCalls: 0,
};

export const pool = {
  async query() {
    daily007SchedulerTestDb.queryCalls += 1;
    throw new Error("Unexpected database query from a disabled scheduler.");
  },
  async connect() {
    daily007SchedulerTestDb.connectCalls += 1;
    throw new Error("Unexpected database connection from a disabled scheduler.");
  },
};
