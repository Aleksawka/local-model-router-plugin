export function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port)) throw new TypeError("Port must be an integer");
  if (port < 1 || port > 65535) throw new RangeError("Port must be between 1 and 65535");
  return port;
}
