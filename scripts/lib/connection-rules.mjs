// The rules of connection_types::validate in the hub, for a catalog source, that a JSON Schema cannot say. The hub
// leaves out of the index every item that fails them, so an item that fails here must not publish. Keep both in step:
// when the hub changes a rule, this file changes in the same week.
import { isIP } from "node:net";

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const field = (...parts) => parts.filter((p) => p !== "").join(".");

/** Query parameters of the authorization request that the hub writes itself. */
const OAUTH_RESERVED_PARAMS = ["response_type", "client_id", "redirect_uri", "state", "code_challenge", "code_challenge_method", "resource", "scope"];
/** Pieces of a key name (lowercase, without `_` and `-`) that mean a credential. */
const SECRET_PIECES = ["secret", "password", "passwd", "apikey", "authorization", "token", "credential", "privatekey"];
/** Last labels of names that only exist inside a network. */
const INTERNAL_TLDS = ["local", "internal", "localdomain", "lan", "intranet", "corp", "home", "private", "test", "invalid", "example"];
/** The hub caps a manifest at 64 KiB in its canonical form (keys sorted, no spaces). */
const MAX_CANONICAL_BYTES = 64 * 1024;
const MAX_TEXT = 2000;

const normKey = (key) => key.replace(/[_-]/g, "").toLowerCase();
/** `to_ascii_lowercase` and `trim` of Rust: a Kelvin sign stays what it is, and a byte order mark is not a blank. */
const asciiLower = (text) => text.replace(/[A-Z]/g, (c) => c.toLowerCase());
export const rustTrim = (text) => text.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "");

/** Errors as `{ field, message }` for a connection item already parsed. The schema covers keys, types and enums. */
export function connectionRules(item) {
  const errors = [];
  const push = (at, message) => errors.push({ field: at, message });
  errors.push(...nulErrors(item, ""), ...secretErrors(item, "", true));
  for (const key of ["name", "description"]) errors.push(...blankText(item[key], key));
  // The hub counts bytes here, the schema counts characters.
  for (const key of ["minAppVersion", "min_app_version"]) {
    if (typeof item[key] === "string" && Buffer.byteLength(item[key], "utf8") > 40) push(key, "is over 40 bytes, the most the hub takes");
  }
  const m = item.manifest;
  if (!isObject(m)) return errors;

  const runsOn = Array.isArray(m.runs_on) ? m.runs_on : [];
  const methods = Array.isArray(m.methods) ? m.methods : [];
  const seen = new Set();
  methods.forEach((method, i) => {
    if (!isObject(method)) return;
    const at = field("manifest.methods", i);
    const type = method.type;
    if (type === "session") push(field(at, "type"), "the session method is not accepted yet: the hub has no safe place for a browser cookie; use oauth, token, cli or none");
    if (typeof type !== "string") return;
    if (seen.has(type)) push(field(at, "type"), `the "${type}" method appears twice`);
    seen.add(type);
    if (type === "oauth" && !runsOn.includes("hub")) push(field(at, "type"), "the oauth method needs runs_on hub: the hub does the sign-in and keeps the grant");
    if (type === "cli") {
      if (!runsOn.includes("mac")) push(field(at, "type"), "the cli method needs runs_on mac: the command is the one on the person's machine");
      if (typeof method.reader !== "string" || rustTrim(method.reader) === "") push(field(at, "reader"), "the cli method needs a reader, the name of the command");
    }
  });

  const hasOauth = seen.has("oauth");
  if (!hasOauth && m.oauth !== undefined) push("manifest.oauth", "the oauth block goes only with the oauth method");
  if (hasOauth && !isObject(m.oauth)) push("manifest.oauth", "the oauth method needs the oauth block, with the URLs of the provider");
  if (isObject(m.oauth)) {
    const auth = m.oauth.authorization_url;
    if (typeof auth === "string" && URL.canParse(rustTrim(auth))) {
      const reserved = [...new URL(rustTrim(auth)).searchParams.keys()].find((k) => OAUTH_RESERVED_PARAMS.includes(k.toLowerCase()));
      if (reserved !== undefined) push("manifest.oauth.authorization_url", `the authorization URL must not carry "${reserved}": the hub fills it in`);
    }
    if (m.oauth.dynamic_registration === true && (typeof m.oauth.registration_url !== "string" || m.oauth.registration_url === "")) {
      push("manifest.oauth.registration_url", "with dynamic_registration true, give registration_url too");
    }
  }

  if (Array.isArray(m.fields)) {
    const keys = new Set();
    m.fields.forEach((f, i) => {
      if (!isObject(f) || typeof f.key !== "string") return;
      const at = field("manifest.fields", i, "key");
      if (SECRET_PIECES.some((p) => f.key.replaceAll("_", "").includes(p))) push(at, `"${f.key}" looks like a credential: a credential goes to the vault of the hub, never in a field`);
      if (keys.has(f.key)) push(at, `the field "${f.key}" appears twice`);
      keys.add(f.key);
      errors.push(...blankText(f.label, field("manifest.fields", i, "label")));
    });
  }
  for (const list of ["triggers", "actions", "tools", "scope_keys"]) {
    if (!Array.isArray(m[list])) continue;
    m[list].forEach((entry, i) => {
      if (!isObject(entry)) return;
      const at = field("manifest", list, i);
      if (list === "tools" && typeof entry.name === "string" && rustTrim(entry.name) === "") push(field(at, "name"), "a tool needs a name");
      for (const key of ["label", "description"]) errors.push(...blankText(entry[key], field(at, key)));
    });
  }

  if (Array.isArray(m.hosts)) {
    m.hosts.forEach((host, i) => {
      if (typeof host !== "string") return;
      const why = hostError(rustTrim(host));
      if (why !== undefined) push(field("manifest.hosts", i), why);
    });
  }
  for (const { at, url } of endpointUrls(m, "manifest")) {
    const why = urlError(url);
    if (why !== undefined) push(at, why);
  }

  const canonical = canonicalJson({ ...item, kind: "connection" });
  if (Buffer.byteLength(canonical, "utf8") > MAX_CANONICAL_BYTES) push("manifest", "the item is over 64 KiB in its canonical form, the most the hub keeps");
  return errors;
}

/** A NUL cannot be stored in the hub's jsonb, and no manifest has a reason to carry one. */
function nulErrors(value, at) {
  if (typeof value === "string") return value.includes("\0") ? [{ field: at, message: "a NUL character cannot be stored" }] : [];
  if (Array.isArray(value)) return value.flatMap((v, i) => nulErrors(v, field(at, i)));
  if (isObject(value)) {
    return Object.entries(value).flatMap(([k, v]) => (k.includes("\0") ? [{ field: field(at, k), message: "a NUL character cannot be stored" }] : nulErrors(v, field(at, k))));
  }
  return [];
}

/**
 * What looks like a credential: a key named like one, or a value that is a bearer or basic header. Keys ending in
 * url or uri are addresses, and the texts a person reads (name, description, label) may start with "Basic".
 */
function secretErrors(value, at, values) {
  if (Array.isArray(value)) return value.flatMap((v, i) => secretErrors(v, field(at, i), values));
  if (isObject(value)) {
    return Object.entries(value).flatMap(([k, v]) => {
      const norm = normKey(k);
      const address = norm.endsWith("url") || norm.endsWith("uri");
      if (!address && SECRET_PIECES.some((p) => norm.includes(p))) {
        return [{ field: field(at, k), message: `"${k}" looks like a credential: a credential never goes in the manifest` }];
      }
      return secretErrors(v, field(at, k), values && !["name", "description", "label"].includes(k));
    });
  }
  if (typeof value === "string" && values && /^(bearer|basic) /i.test(value.trimStart())) {
    return [{ field: at, message: "a value that starts with Bearer or Basic looks like a credential" }];
  }
  return [];
}

/** A text a person reads, when present, has both languages filled once trimmed and is not too long. */
function blankText(value, at) {
  if (!isObject(value)) return [];
  return ["pt-BR", "en"].flatMap((lang) => {
    const text = value[lang];
    if (typeof text !== "string") return [];
    if (rustTrim(text) === "") return [{ field: field(at, lang), message: "is blank: the hub needs the text in pt-BR and en" }];
    if ([...rustTrim(text)].length > MAX_TEXT) return [{ field: field(at, lang), message: `is longer than ${MAX_TEXT} characters` }];
    return [];
  });
}

/** Every string under a key that is an address (`url`, `token_url`, `endpoint`...), at any depth, with its path. */
export function endpointUrls(value, at) {
  if (Array.isArray(value)) return value.flatMap((v, i) => endpointUrls(v, field(at, i)));
  if (!isObject(value)) return [];
  return Object.entries(value).flatMap(([k, v]) => {
    const norm = normKey(k);
    if (typeof v === "string" && ["url", "uri", "endpoint"].some((s) => norm.endsWith(s))) return [{ at: field(at, k), url: v }];
    return endpointUrls(v, field(at, k));
  });
}

/**
 * Scheme, host and the port the URL spells out, read like the egress guard of the hub (`egress::parse_url`):
 * credentials in the address, blanks, control characters and a backslash are refused before the parser fixes them.
 */
export function parseUrl(raw) {
  const text = rustTrim(raw);
  const sep = text.indexOf("://");
  if (sep < 0) return { error: "needs https://" };
  const rest = text.slice(sep + 3);
  if (/[\s\p{Cc}\\]/u.test(rest)) return { error: "has an invalid character" };
  const authority = rest.split(/[/?#]/)[0];
  if (authority.includes("@")) return { error: "must not carry a user and password" };
  // A catalog convention, stricter than the hub: a host is written in ASCII, so no look-alike letter hides in it.
  if (/[^\x00-\x7f]/.test(authority)) return { error: "has a host that is not in ASCII" };
  let url;
  try {
    url = new URL(text);
  } catch {
    return { error: "is not a valid address" };
  }
  if (url.port === "0") return { error: "has an invalid port" };
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.+$/, "");
  if (host === "") return { error: "has no host" };
  return { scheme: url.protocol.slice(0, -1), host, port: url.port === "" ? undefined : Number(url.port) };
}

function urlError(url) {
  const parsed = parseUrl(url);
  if (parsed.error !== undefined) return `the address ${parsed.error}`;
  // The hub calls only over https and the egress guard only on port 443, wherever the type runs, for a catalog item.
  if (parsed.scheme !== "https") return `the address of ${parsed.host} must be https`;
  if (parsed.port !== undefined && parsed.port !== 443) return `the address of ${parsed.host} uses a port other than 443, the only one the hub calls`;
  return hostError(parsed.host);
}

/** Why a host is not a public DNS name, or undefined when it is. The catalog takes public names only (C5a, decision 6). */
export function hostError(raw) {
  const host = asciiLower(raw).replace(/\.+$/, "");
  const bare = host.replace(/^\[|\]$/g, "");
  if (isIP(bare) !== 0) {
    return isPrivate(bare) ? `${host} is in a private range: only public names are accepted` : `${host} is an IP address: use the public name of the server`;
  }
  const labels = host.split(".");
  const nameOk = host !== "" && host.length <= 253 && labels.every((l) => l !== "" && l.length <= 63 && !l.startsWith("-") && !l.endsWith("-") && /^[a-z0-9-]+$/.test(l));
  if (!nameOk) return `"${host}" is not a host name${/[^\x00-\x7f]/.test(host) ? ": the catalog takes hosts in ASCII only" : ""}`;
  // A catalog convention, stricter than the hub: no punycode label, the form a look-alike name takes.
  if (labels.some((l) => l.startsWith("xn--"))) return `${host} is in punycode: the catalog takes plain ASCII names only`;
  // 2130706433 and 0x7f.1 are addresses to a resolver even though they are not dotted quads.
  if (labels.every((l) => /^[0-9]+$/.test(l) || /^0x[0-9a-f]+$/.test(l))) return `${host} is an IP address: use the public name of the server`;
  const last = labels.at(-1);
  if (last === "localhost") return `${host} is this machine: only public names are accepted`;
  if (labels.length < 2) return `${host} has no domain, so it is a name of an internal network`;
  if (INTERNAL_TLDS.includes(last) || host.endsWith(".home.arpa") || last === "arpa") return `${host} is a name of an internal network: only public names are accepted`;
  return undefined;
}

/** The ranges of the egress guard that a name check can tell: loopback, private, link local, shared, unspecified. */
function isPrivate(ip) {
  const v4 = ip.match(/^(?:::ffff:)?(\d+)\.(\d+)\.(\d+)\.(\d+)$/i);
  if (v4 !== null) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const v6 = ip.toLowerCase();
  return v6 === "::" || v6 === "::1" || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || v6.startsWith("::ffff:");
}

/** The same value always gives the same text: keys sorted at every level, no spaces, as `canonical_json` in the hub. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
