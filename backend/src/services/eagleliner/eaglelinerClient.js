import axios from 'axios';
import { createHash } from 'crypto';

function sha512(value) {
  return createHash('sha512').update(String(value || ''), 'utf8').digest('hex');
}

function buildCredentials({ username, password }) {
  const resolvedUsername = username || process.env.EAGLE_USERNAME;
  const resolvedPassword = password || process.env.EAGLE_PASSWORD;

  if (!resolvedUsername || !resolvedPassword) {
    const err = new Error(
      'Missing Eagleliner credentials. Set EAGLE_USERNAME and EAGLE_PASSWORD in backend .env (or provide username/password explicitly).'
    );
    err.statusCode = 500;
    throw err;
  }

  return {
    Credentials: {
      username: resolvedUsername,
      password: sha512(resolvedPassword),
    },
  };
}

export function createEaglelinerClient() {
  const baseUrl = process.env.EAGLE_BASE_URL || 'https://enable.eaglezim.co.za';
  const timeoutMs = Number(process.env.EAGLE_TIMEOUT_MS) || 30000;

  const http = axios.create({
    baseURL: baseUrl,
    timeout: timeoutMs,
    validateStatus: () => true,
  });

  async function request({ method, path, username, password, data }) {
    const payload = data
      ? { ...buildCredentials({ username, password }), ...data }
      : buildCredentials({ username, password });

    const res = await http.request({
      method,
      url: path,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      data: payload,
    });

    if (res.status >= 400) {
      const err = new Error(`Eagleliner upstream error ${res.status}`);
      err.statusCode = 502;
      err.details = res.data;
      throw err;
    }

    return res.data;
  }

  return { request };
}
