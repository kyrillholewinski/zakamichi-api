import axios from 'axios';

/**
 * A robust function to make API calls using Axios.
 * It always returns an object and never throws an error,
 * so you can safely check the result.
 *
 * @param {string} method - The HTTP method (e.g., 'GET', 'POST', 'PUT', 'DELETE').
 * @param {string} url - The API endpoint URL.
 * @param {object} [data=null] - The request body (for POST, PUT, PATCH).
 * @param {object} [params=null] - The URL parameters (query string).
 * @param {object} [headers={}] - Any custom headers.
 * @returns {Promise<object>} An object with the shape:
 * { success: boolean, status: number|null, data: any }
 */
export async function httpRequest(axiosConfig) {
  try {
    // Make the request using the provided configuration
    const response = await axios(axiosConfig);

    // --- Success ---
    // The request was successful (e.g., 200 OK)
    return {
      success: true,
      status: response.status,
      data: response.data,
    };

  } catch (error) {
    // --- Failure ---
    // The code enters this block if Axios throws an error.

    if (error.response) {
      // The server responded with a non-2xx status code (e.g., 404, 500)
      console.error('API Error:', error.response.status, error.response.data);
      return {
        success: false,
        status: error.response.status, // e.g., 404
        data: error.response.data,     // e.g., { message: 'Not Found' }
      };
    } else if (error.request) {
      // The request was made, but no response was received (e.g., network error, server down)
      console.error('Network Error:', error.message);
      return {
        success: false,
        status: null,
        data: 'Network Error: No response received from server.',
      };
    } else {
      // Something else went wrong setting up the request
      console.error('Axios Setup Error:', error.message);
      return {
        success: false,
        status: null,
        data: `Error: ${error.message}`,
      };
    }
  }
}

export async function loadUrlStream(url, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const { status, data } = await axios.get(url, { responseType: 'stream' });
            if (status === 200) {
                return data;
            } else {
                console.error(`Failed with status ${response.status}. Retry: ${i}`);
            }
        } catch (ex) {
            console.error(`Connect to ${url} Fail: ${ex.message} Retry: ${i}`);
        }
    }
    return null;
}