export class ApiError extends Error {
  constructor(public status: number, message: string, public data?: any) {
    super(message);
    this.name = 'ApiError';
  }
}

export const apiClient = {
  async get<T>(url: string, init?: RequestInit): Promise<T> {
    return this.request<T>(url, { ...init, method: 'GET' });
  },

  async post<T>(url: string, body?: any, init?: RequestInit): Promise<T> {
    return this.request<T>(url, {
      ...init,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...init?.headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  },

  async patch<T>(url: string, body?: any, init?: RequestInit): Promise<T> {
    return this.request<T>(url, {
      ...init,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...init?.headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  },

  async delete<T>(url: string, init?: RequestInit): Promise<T> {
    return this.request<T>(url, { ...init, method: 'DELETE' });
  },

  async request<T>(url: string, init: RequestInit): Promise<T> {
    const response = await fetch(url, init);

    if (!response.ok) {
      let errorMessage = response.statusText;
      let errorData;
      try {
        errorData = await response.json();
        errorMessage = errorData.error || errorMessage;
      } catch {
        try {
          errorMessage = await response.text() || errorMessage;
        } catch { }
      }
      throw new ApiError(response.status, errorMessage, errorData);
    }
    try {
      return (await response.json()) as T;
    } catch {
      return {} as T;
    }
  }
};
