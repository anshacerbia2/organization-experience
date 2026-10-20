import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';

// The Organization Control API's published contract, read for the contract test ADR-GLB-010 §5.1 asks
// of a hand-written client (TDD-organization-experience-001 1.12.0 §API / Interface). The text is
// organization-control's api/openapi.yaml at the commit pin.json names, vendored beside it and checked
// byte for byte by scripts/check-api-contract.mjs.
//
// An OpenAPI 3.1 Schema Object "is a superset of JSON Schema Specification Draft 2020-12", so each
// schema is checked with Ajv's draft 2020-12 validator against the whole document, its $refs resolved
// in place. The functions here say what is wrong, as sentences; they never throw on a bad request.

interface Parameter {
  readonly name: string;
  readonly in: 'header' | 'query' | 'path' | 'cookie';
  readonly required?: boolean;
  readonly schema?: unknown;
}

interface Operation {
  readonly operationId: string;
  readonly parameters?: readonly (Parameter | { readonly $ref: string })[];
  readonly requestBody?: unknown;
  readonly responses?: Readonly<Record<string, unknown>>;
}

interface Document {
  readonly info: { readonly version: string };
  readonly paths: Readonly<Record<string, Readonly<Record<string, Operation>>>>;
  readonly components: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

export interface Request {
  readonly method: string;
  // path is the API's, starting /v1/, with its query.
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}

export interface Matched {
  readonly template: string;
  readonly method: string;
  readonly operation: Operation;
}

export interface ResponseOptions {
  // closed also refuses a member the schema does not name, for a fixture the application is tested
  // against: a field the client reads must be one the API answers.
  readonly closed?: boolean;
}

export interface Contract {
  readonly version: string;
  readonly paths: readonly string[];
  match: (method: string, path: string) => Matched | null;
  // pathExists says whether any operation serves a path, whatever its method.
  pathExists: (path: string) => boolean;
  checkRequest: (request: Request) => string[];
  checkResponse: (
    method: string,
    path: string,
    status: number,
    body: unknown,
    options?: ResponseOptions,
  ) => string[];
}

const id = 'organization-control';

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A template as a pattern: each {parameter} is one segment.
const patternOf = (template: string): RegExp =>
  new RegExp(
    `^${template
      .split(/\{[^}]+\}/)
      .map(escape)
      .join('[^/]+')}$`,
  );

const pointer = (ref: string): string => ref.replace(/^#/, '');

export function createContract(text: string): Contract {
  const document = parse(text) as Document;
  const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: true });
  addFormats.default(ajv);
  ajv.addFormat('int64', { type: 'number', validate: (value: number) => Number.isSafeInteger(value) });
  ajv.addSchema(document, id);

  const resolve = <T>(value: T | { readonly $ref: string }): T => {
    if (typeof value === 'object' && value !== null && '$ref' in value) {
      const parts = pointer(value.$ref).split('/').filter(Boolean);
      let found: unknown = document;
      for (const part of parts) {
        found = (found as Record<string, unknown>)[part];
      }
      return found as T;
    }
    return value;
  };

  // Each schema is compiled once, by where it is in the document, so its $refs resolve against it.
  const compiled = new Map<string, ValidateFunction>();
  const validatorAt = (location: string): ValidateFunction => {
    let validate = compiled.get(location);
    if (validate === undefined) {
      validate = ajv.compile({ $ref: `${id}#${location}` });
      compiled.set(location, validate);
    }
    return validate;
  };
  const errorsOf = (validate: ValidateFunction): string =>
    (validate.errors ?? [])
      .slice(0, 12)
      .map((error) => `${error.instancePath === '' ? '(body)' : error.instancePath} ${error.message ?? ''}`)
      .join('; ');

  const templates = Object.keys(document.paths)
    .map((template) => ({ template, pattern: patternOf(template), literal: !template.includes('{') }))
    // A literal path wins over a template that also matches it: /v1/invitations/accept is not an
    // invitation_id.
    .sort((a, b) => Number(b.literal) - Number(a.literal));

  const encodedPointer = (template: string): string => template.replaceAll('~', '~0').replaceAll('/', '~1');

  const match = (method: string, path: string): Matched | null => {
    const bare = path.split('?')[0] ?? '';
    const lower = method.toLowerCase();
    for (const { template, pattern } of templates) {
      const operation = document.paths[template]?.[lower];
      if (pattern.test(bare) && operation !== undefined) {
        return { template, method: lower, operation };
      }
    }
    return null;
  };

  const pathExists = (path: string): boolean => {
    const bare = path.split('?')[0] ?? '';
    return templates.some(({ pattern }) => pattern.test(bare));
  };

  const checkRequest = (request: Request): string[] => {
    const where = `${request.method} ${request.path}`;
    const matched = match(request.method, request.path);
    if (matched === null) {
      return [`${where}: no operation of organization-control ${document.info.version} serves it`];
    }
    const problems: string[] = [];
    // Each parameter with where its schema is in the document, so the schema's $refs resolve.
    const parameters = (matched.operation.parameters ?? []).map((parameter, index) => {
      const ref = '$ref' in parameter ? parameter.$ref : undefined;
      const location =
        ref === undefined
          ? `/paths/${encodedPointer(matched.template)}/${matched.method}/parameters/${String(index)}`
          : pointer(ref);
      return { ...resolve(parameter), location };
    });
    const headers = Object.fromEntries(
      Object.entries(request.headers).map(([name, value]) => [name.toLowerCase(), value]),
    );

    // The query: only declared parameters, each once, each as its schema says. Organization Control
    // answers an unknown or repeated parameter with 400.
    const query = new URLSearchParams(request.path.split('?')[1] ?? '');
    const declared = new Map(parameters.filter((p) => p.in === 'query').map((p) => [p.name, p]));
    for (const name of new Set(query.keys())) {
      const parameter = declared.get(name);
      if (parameter === undefined) {
        problems.push(`${where}: query parameter ${name} is not declared`);
        continue;
      }
      if (query.getAll(name).length > 1) {
        problems.push(`${where}: query parameter ${name} is repeated`);
      }
      const value = query.get(name) ?? '';
      // A query value is text; an integer parameter is its number.
      const validate = validatorAt(`${parameter.location}/schema`);
      if (!validate(value)) {
        const asText = errorsOf(validate);
        if (!/^-?\d+$/.test(value) || !validate(Number(value))) {
          problems.push(`${where}: query parameter ${name}${asText.replace('(body)', '')}`);
        }
      }
    }
    for (const parameter of declared.values()) {
      if (parameter.required === true && !query.has(parameter.name)) {
        problems.push(`${where}: query parameter ${parameter.name} is required`);
      }
    }

    // The Idempotency-Key: required on a command that declares it, refused on a read (STD-GLB-001
    // §Commands Require an Idempotency-Key; Organization Control answers a key on a GET with 400).
    const key = parameters.find((p) => p.in === 'header' && p.name.toLowerCase() === 'idempotency-key');
    const sentKey = headers['idempotency-key'];
    if (key === undefined && sentKey !== undefined) {
      problems.push(`${where}: sends an Idempotency-Key the operation does not take`);
    }
    if (key?.required === true && (sentKey === undefined || sentKey === '')) {
      problems.push(`${where}: sends no Idempotency-Key, which the operation requires`);
    }
    const reason = headers['x-administrative-reason'];
    if (reason !== undefined && reason !== '' && !/^[\t\x20-\x7e]+$/.test(reason)) {
      problems.push(`${where}: X-Administrative-Reason is not visible US-ASCII`);
    }

    // The body, against the request schema of its content type.
    const requestBody = resolve(matched.operation.requestBody as object | undefined) as
      { required?: boolean; content?: Record<string, { schema?: unknown }> } | undefined;
    const hasBody = request.body !== undefined;
    if (requestBody === undefined) {
      // An operation with no body takes none. An empty JSON object carries no member, so it is taken as
      // no body: the client sends `{}` on the commands that take nothing, and the API reads nothing.
      const empty =
        typeof request.body === 'object' && request.body !== null && Object.keys(request.body).length === 0;
      if (hasBody && (request.method.toUpperCase() === 'GET' || !empty)) {
        problems.push(`${where}: sends a body the operation does not take`);
      }
      return problems;
    }
    if (!hasBody) {
      if (requestBody.required === true) {
        problems.push(`${where}: sends no body, which the operation requires`);
      }
      return problems;
    }
    const location = (() => {
      const ref = (matched.operation.requestBody as { $ref?: string } | undefined)?.$ref;
      const base =
        ref === undefined
          ? `/paths/${encodedPointer(matched.template)}/${matched.method}/requestBody`
          : pointer(ref);
      return `${base}/content/application~1json/schema`;
    })();
    const validate = validatorAt(location);
    if (!validate(request.body)) {
      problems.push(`${where}: body ${errorsOf(validate)}`);
    }
    return problems;
  };

  const checkResponse = (
    method: string,
    path: string,
    status: number,
    body: unknown,
    options: ResponseOptions = {},
  ): string[] => {
    const where = `${method} ${path} ${String(status)}`;
    const matched = match(method, path);
    if (matched === null) {
      return [`${where}: no operation of organization-control ${document.info.version} serves it`];
    }
    const declared = matched.operation.responses?.[String(status)];
    if (declared === undefined) {
      return [`${where}: the operation declares no ${String(status)} answer`];
    }
    const ref = (declared as { $ref?: string }).$ref;
    const base =
      ref === undefined
        ? `/paths/${encodedPointer(matched.template)}/${matched.method}/responses/${String(status)}`
        : pointer(ref);
    const response = resolve(declared as object) as { content?: Record<string, unknown> };
    const type = Object.keys(response.content ?? {})[0];
    if (type === undefined) {
      return body === undefined || body === null || body === '' ? [] : [`${where}: answers no body`];
    }
    const schema = (response.content?.[type] as { schema?: unknown } | undefined)?.schema;
    const validate = validatorAt(`${base}/content/${type.replaceAll('/', '~1')}/schema`);
    const problems = validate(body) ? [] : [`${where}: ${errorsOf(validate)}`];
    if (options.closed === true) {
      problems.push(
        ...undeclared(schema, body, '').map((field) => `${where}: ${field} is not in the specification`),
      );
    }
    return problems;
  };

  // undeclared lists the members of a value its schema does not name, wherever the schema names its
  // members: the fields a client reads that the API never answers. JSON Schema leaves an object open
  // unless it says otherwise, so the validator above accepts them; a fixture holding one would test the
  // application against data Organization Control does not serve.
  const undeclared = (schema: unknown, value: unknown, at: string): string[] => {
    const resolved = resolve(schema as object | undefined) as
      | {
          properties?: Record<string, unknown>;
          allOf?: unknown[];
          items?: unknown;
          additionalProperties?: unknown;
        }
      | undefined;
    if (resolved === undefined || value === null || typeof value !== 'object') {
      return [];
    }
    if (Array.isArray(value)) {
      return resolved.items === undefined
        ? []
        : value.flatMap((item, index) => undeclared(resolved.items, item, `${at}/${String(index)}`));
    }
    const parts = [
      resolved,
      ...(resolved.allOf ?? []).map((part) => resolve(part as object) as typeof resolved),
    ];
    const properties: Record<string, unknown> = Object.assign(
      {},
      ...parts.map((part) => part.properties ?? {}),
    ) as Record<string, unknown>;
    if (
      Object.keys(properties).length === 0 ||
      parts.some((part) => typeof part.additionalProperties === 'object')
    ) {
      return [];
    }
    return Object.entries(value as Record<string, unknown>).flatMap(([name, member]) =>
      name in properties ? undeclared(properties[name], member, `${at}/${name}`) : [`${at}/${name}`],
    );
  };

  const paths = Object.keys(document.paths);
  return { version: document.info.version, paths, match, pathExists, checkRequest, checkResponse };
}
