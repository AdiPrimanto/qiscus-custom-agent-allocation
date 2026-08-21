import { describe, expect, it } from 'vitest';
import nock from 'nock';
import axios from 'axios';
import { describeApiError } from '../src/qiscus/errors';

describe('describeApiError', () => {
  it('pulls the response status and body out of an Axios error', async () => {
    nock('https://example.com').post('/thing').reply(400, { errors: ['room already assigned'] });

    let caught: unknown;
    try {
      await axios.post('https://example.com/thing', {});
    } catch (error) {
      caught = error;
    }

    const described = describeApiError(caught);

    expect(described).toMatchObject({
      status: 400,
      data: { errors: ['room already assigned'] },
      url: 'https://example.com/thing',
    });
  });

  it('passes non-Axios errors through unchanged', () => {
    const error = new Error('something else broke');

    expect(describeApiError(error)).toBe(error);
  });
});
