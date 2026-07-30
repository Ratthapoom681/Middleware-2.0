export function requireApiCollection(payload, {
  property,
  label = 'Data',
} = {}) {
  if (Array.isArray(payload)) return payload;
  if (property && Array.isArray(payload?.[property])) return payload[property];

  throw new Error(
    `${label} could not be loaded because the server returned an unexpected response. `
    + 'Please refresh the page or ask an administrator to verify the deployment.',
  );
}
