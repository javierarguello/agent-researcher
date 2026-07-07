/**
 * Gemini via Vertex AI (`@google/genai` with `vertexai: true`).
 *
 * Auth is Application Default Credentials: the attached service account on
 * Cloud Run, or `gcloud auth application-default login` locally. No API keys,
 * no service-account JSON files.
 */
import { FunctionCallingConfigMode, GoogleGenAI } from '@google/genai';
import type {
  Content,
  FunctionDeclaration,
  Part,
  Schema,
} from '@google/genai';
import { config } from '../config.js';
import type {
  GenerateOptions,
  GenerateResult,
  JsonSchema,
  LlmMessage,
  LlmProvider,
  ToolCall,
  ToolSchema,
} from './provider.js';

export class GeminiVertexProvider implements LlmProvider {
  readonly name = 'gemini-vertex';
  private readonly client: GoogleGenAI;

  constructor() {
    this.client = new GoogleGenAI({
      vertexai: true,
      project: config.gcp.projectId,
      location: config.gcp.location,
    });
  }

  async generate(opts: GenerateOptions): Promise<GenerateResult> {
    const contents = opts.messages.map(toContent);
    // Structured output and tool-calling are mutually exclusive on Gemini.
    const structured = !!opts.responseSchema;
    const tools =
      structured || opts.disableTools || !opts.tools?.length
        ? undefined
        : [{ functionDeclarations: opts.tools.map(toFunctionDeclaration) }];

    const response = await withRetry(() =>
      this.client.models.generateContent({
        model: opts.model,
        contents,
        config: {
          systemInstruction: opts.system,
          temperature: opts.temperature ?? 0.2,
          ...(opts.maxOutputTokens ? { maxOutputTokens: opts.maxOutputTokens } : {}),
          ...(structured
            ? {
                responseMimeType: 'application/json',
                responseSchema: jsonSchemaToGemini(opts.responseSchema as JsonSchemaNode),
              }
            : {}),
          ...(tools ? { tools } : {}),
          ...(tools && opts.forceTools
            ? { toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY } } }
            : {}),
        },
      }),
    );

    const parts = response.candidates?.[0]?.content?.parts ?? [];
    let text = '';
    const toolCalls: ToolCall[] = [];
    for (const part of parts) {
      if (part.text) text += part.text;
      if (part.functionCall?.name) {
        toolCalls.push({
          id: part.functionCall.id ?? `${part.functionCall.name}-${toolCalls.length}`,
          name: part.functionCall.name,
          args: (part.functionCall.args ?? {}) as Record<string, unknown>,
        });
      }
    }
    return { text: text.trim(), toolCalls };
  }
}

// --- retry ------------------------------------------------------------------

/** Status codes worth retrying: rate limit + transient server errors. */
const RETRYABLE = new Set([429, 500, 503]);
const MAX_ATTEMPTS = 6;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Retries a call with exponential backoff + jitter on transient Vertex errors. */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number })?.status;
      if (!status || !RETRYABLE.has(status) || attempt === MAX_ATTEMPTS - 1) throw err;
      // 2s, 4s, 8s, 16s, 32s (+ up to 1s jitter).
      const delay = 2 ** (attempt + 1) * 1000 + Math.floor(Math.random() * 1000);
      console.error(`[gemini] ${status} — retry ${attempt + 1}/${MAX_ATTEMPTS - 1} in ${delay}ms`);
      await sleep(delay);
    }
  }
  throw lastErr;
}

// --- genai mapping helpers --------------------------------------------------

function toContent(msg: LlmMessage): Content {
  if (msg.role === 'tool' && msg.toolResult) {
    // Function responses ride in a `user`-role turn (Gemini allows only
    // user/model roles; the functionResponse part marks it as a tool result).
    return {
      role: 'user',
      parts: [
        {
          functionResponse: {
            name: msg.toolResult.name,
            response: normalizeResponse(msg.toolResult.response),
          },
        },
      ],
    };
  }

  const parts: Part[] = [];
  if (msg.text) parts.push({ text: msg.text });
  for (const call of msg.toolCalls ?? []) {
    parts.push({ functionCall: { name: call.name, args: call.args } });
  }
  if (parts.length === 0) parts.push({ text: '' });

  return { role: msg.role === 'model' ? 'model' : 'user', parts };
}

/** functionResponse.response must be a JSON object; wrap non-objects. */
function normalizeResponse(response: unknown): Record<string, unknown> {
  if (response && typeof response === 'object' && !Array.isArray(response)) {
    return response as Record<string, unknown>;
  }
  return { result: response };
}

function toFunctionDeclaration(tool: ToolSchema): FunctionDeclaration {
  return {
    name: tool.name,
    description: tool.description,
    parameters: toGeminiSchema(tool.parameters),
  };
}

const TYPE_MAP: Record<JsonSchema['type'], string> = {
  object: 'OBJECT',
  string: 'STRING',
  number: 'NUMBER',
  integer: 'INTEGER',
  boolean: 'BOOLEAN',
  array: 'ARRAY',
};

/** Convert our JSON-Schema tool params into Gemini's OpenAPI-ish Schema. */
function toGeminiSchema(schema: JsonSchema): Schema {
  const out: Schema = { type: TYPE_MAP[schema.type] as Schema['type'] };
  if (schema.description) out.description = schema.description;
  if (schema.enum) out.enum = schema.enum;
  if (schema.properties) {
    out.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([key, value]) => [key, toGeminiSchema(value)]),
    );
  }
  if (schema.required) out.required = schema.required;
  if (schema.items) out.items = toGeminiSchema(schema.items);
  return out;
}

// --- Structured output: standard JSON Schema -> Gemini responseSchema --------
//
// z.toJSONSchema() emits draft-2020-12: unions for nullables, $defs/$ref for
// reused shapes, and metadata keywords Gemini rejects. This normalizes any such
// document into the OpenAPI-ish subset Gemini's controlled generation accepts.

type JsonSchemaNode = Record<string, unknown>;

const JSON_TYPE_MAP: Record<string, Schema['type']> = {
  object: 'OBJECT' as Schema['type'],
  string: 'STRING' as Schema['type'],
  number: 'NUMBER' as Schema['type'],
  integer: 'INTEGER' as Schema['type'],
  boolean: 'BOOLEAN' as Schema['type'],
  array: 'ARRAY' as Schema['type'],
};

/** Resolve a local "#/$defs/Name" (or legacy "#/definitions/Name") reference. */
function resolveRef(ref: string, defs: Record<string, JsonSchemaNode>): JsonSchemaNode {
  const name = ref.replace(/^#\/(?:\$defs|definitions)\//, '');
  const target = defs[name];
  if (!target) throw new Error(`Cannot resolve $ref "${ref}" in response schema.`);
  return target;
}

/** Split a nullable union into its single concrete branch + a nullable flag. */
function unwrapNullable(node: JsonSchemaNode): { node: JsonSchemaNode; nullable: boolean } {
  // Form 1: { type: ['string', 'null'] }
  if (Array.isArray(node.type)) {
    const types = (node.type as string[]).filter((t) => t !== 'null');
    return { node: { ...node, type: types[0] }, nullable: (node.type as string[]).includes('null') };
  }
  // Form 2: { anyOf|oneOf: [ {...}, { type: 'null' } ] }
  const union = (node.anyOf ?? node.oneOf) as JsonSchemaNode[] | undefined;
  if (Array.isArray(union)) {
    const nonNull = union.filter((s) => s.type !== 'null');
    const nullable = union.some((s) => s.type === 'null');
    // We only model `T | null`; take the first concrete branch, carry description.
    const merged: JsonSchemaNode = { ...nonNull[0] };
    if (node.description && !merged.description) merged.description = node.description;
    return { node: merged, nullable };
  }
  return { node, nullable: false };
}

export function jsonSchemaToGemini(
  root: JsonSchemaNode,
  node: JsonSchemaNode = root,
  defs?: Record<string, JsonSchemaNode>,
): Schema {
  const definitions =
    defs ?? ((root.$defs ?? root.definitions) as Record<string, JsonSchemaNode> | undefined) ?? {};

  if (typeof node.$ref === 'string') {
    return jsonSchemaToGemini(root, resolveRef(node.$ref, definitions), definitions);
  }

  const { node: base, nullable } = unwrapNullable(node);
  const out: Schema = {};

  const typeName = typeof base.type === 'string' ? base.type : undefined;
  if (typeName && JSON_TYPE_MAP[typeName]) out.type = JSON_TYPE_MAP[typeName];
  if (typeof base.description === 'string') out.description = base.description;
  if (Array.isArray(base.enum)) {
    out.enum = base.enum as string[];
    if (!out.type) out.type = 'STRING' as Schema['type'];
  }
  if (nullable) out.nullable = true;

  if (base.properties && typeof base.properties === 'object') {
    out.properties = Object.fromEntries(
      Object.entries(base.properties as Record<string, JsonSchemaNode>).map(([k, v]) => [
        k,
        jsonSchemaToGemini(root, v, definitions),
      ]),
    );
    if (Array.isArray(base.required)) out.required = base.required as string[];
  }
  if (base.items && typeof base.items === 'object') {
    out.items = jsonSchemaToGemini(root, base.items as JsonSchemaNode, definitions);
  }
  return out;
}
