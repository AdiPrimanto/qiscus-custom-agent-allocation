import axios from 'axios';

// console.error truncates nested objects (like AxiosError.response.data) at
// low depth, so Qiscus's actual validation message shows up as `[Object]` in
// production logs instead of the text that would explain the failure. Pull
// out the parts worth seeing before logging instead of passing the raw error.
export function describeApiError(error: unknown): unknown {
  if (axios.isAxiosError(error)) {
    return {
      message: error.message,
      url: error.config?.url,
      status: error.response?.status,
      data: error.response?.data,
    };
  }
  return error;
}
