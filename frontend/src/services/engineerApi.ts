import {
  DiscoverRequest,
  GraphObject,
  PMLibraryFunction,
  SimplifyRequest,
} from '../types/processMining';

export class EngineerApiClient {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    const defaultUrl =
      (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_BASE_URL ||
      'http://localhost:8000';
    this.baseUrl = (baseUrl || defaultUrl).replace(/\/+$/, '');
  }

  public setBaseUrl(url: string) {
    this.baseUrl = url.replace(/\/+$/, '');
  }

  public getBaseUrl() {
    return this.baseUrl;
  }

  private async requestJson<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...(init?.headers || {}),
      },
    });
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const err = await res.json();
        detail = err.detail || JSON.stringify(err);
      } catch {
        detail = await res.text();
      }
      throw new Error(detail);
    }
    return res.json() as Promise<T>;
  }

  async checkHealth(): Promise<{ status: string; app?: string }> {
    return this.requestJson('/health');
  }

  async uploadEventLog(
    file: File
  ): Promise<{ file_id: string; filename: string; format: string }> {
    const form = new FormData();
    form.append('file', file);
    return this.requestJson('/api/v1/discovery/upload', {
      method: 'POST',
      body: form,
    });
  }

  async discoverModel(payload: DiscoverRequest): Promise<GraphObject> {
    return this.requestJson('/api/v1/discovery/discover', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async uploadGraphFile(
    file: File
  ): Promise<{ graph_id: string; filename: string; format: string; graph: GraphObject }> {
    const form = new FormData();
    form.append('file', file);
    return this.requestJson('/api/v1/graphs/upload', {
      method: 'POST',
      body: form,
    });
  }

  async getGraph(graphId: string): Promise<GraphObject> {
    return this.requestJson(`/api/v1/graphs/${encodeURIComponent(graphId)}`);
  }

  async listPmFunctions(category?: string): Promise<{
    categories: string[];
    total: number;
    functions: Record<string, PMLibraryFunction[]>;
  }> {
    const qs = category ? `?category=${encodeURIComponent(category)}` : '';
    return this.requestJson(`/api/v1/pm-library/functions${qs}`);
  }

  async runPmFunctionView(
    functionName: string,
    fileId: string,
    extraParams: Record<string, unknown> = {}
  ): Promise<{
    function: string;
    image_format?: string;
    image_base64?: string;
    result?: unknown;
    message?: string;
  }> {
    return this.requestJson(
      `/api/v1/pm-library/functions/${encodeURIComponent(functionName)}/view`,
      {
        method: 'POST',
        body: JSON.stringify({ file_id: fileId, extra_params: extraParams }),
      }
    );
  }

  async simplifyGraph(payload: SimplifyRequest): Promise<GraphObject> {
    return this.requestJson('/api/v1/simplification/simplify', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async exportSvg(
    graphJson: GraphObject,
    width = 1400,
    height = 860,
    theme: 'light' | 'dark' = 'light'
  ): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/v1/export/svg`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph_json: graphJson, width, height, theme }),
    });
    if (!res.ok) {
      throw new Error(`Export failed (${res.status})`);
    }
    return res.text();
  }
}

export const engineerApi = new EngineerApiClient();
