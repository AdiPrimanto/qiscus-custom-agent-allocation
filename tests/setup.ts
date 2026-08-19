import path from 'node:path';
import dotenv from 'dotenv';
import nock from 'nock';
import { afterEach } from 'vitest';

dotenv.config({ path: path.resolve(__dirname, '../.env.test'), override: true });

afterEach(() => {
  nock.cleanAll();
});
