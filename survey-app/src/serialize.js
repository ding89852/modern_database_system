import { ObjectId } from 'mongodb';

export function toPlain(value) {
  if (value instanceof ObjectId) return value.toHexString();
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(toPlain);
  if (value && typeof value === 'object') {
    const result = {};
    for (const [key, child] of Object.entries(value)) {
      result[key] = toPlain(child);
    }
    return result;
  }
  return value;
}

export function publicSurvey(survey) {
  const plain = toPlain(survey);
  delete plain.ownerId;
  delete plain.version;
  return plain;
}

export function responseView(response) {
  const plain = toPlain(response);
  delete plain.dedupeKey;
  if (plain.anonymous) {
    delete plain.respondentId;
  }
  return plain;
}
