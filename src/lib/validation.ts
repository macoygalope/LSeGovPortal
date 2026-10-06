/**
 * What the admin API (admin-api.ts) sends back when it refuses a request.
 * `message` is English, for logs and tests; `code` is what the dashboard
 * translates (it looks up `admin.be.<code>`, see messages/fil.ts), and `field`
 * names the input to point at.
 */
export class AdminError extends Error {
  readonly code: string;
  readonly status: number;
  readonly field: string | undefined;
  readonly vars: Record<string, string | number> | undefined;

  constructor(
    code: string,
    message: string,
    options: { status?: number; field?: string; vars?: Record<string, string | number> } = {},
  ) {
    super(message);
    this.name = "AdminError";
    this.code = code;
    this.status = options.status ?? 400;
    this.field = options.field;
    this.vars = options.vars;
  }
}

/** `2026-12-31`, and a day that exists (the database only checks the shape). */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

/** Links end up in `href` and `src`, so only web addresses are accepted. */
export function isWebUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export function checkUrl(field: string, value: string): void {
  if (value && !isWebUrl(value)) {
    throw new AdminError("badUrl", `The link in "${field}" must start with http:// or https://.`, { field });
  }
}

export function checkLength(field: string, value: string, max: number): void {
  if (value.length > max) {
    throw new AdminError("fieldTooLong", `"${field}" is limited to ${max} characters.`, {
      field,
      vars: { max },
    });
  }
}
