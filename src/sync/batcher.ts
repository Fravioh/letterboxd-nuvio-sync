export function* batches<T>(items: readonly T[], size = 100): Generator<T[]> {
  if (!Number.isInteger(size) || size < 1 || size > 100)
    throw new RangeError('Batch size must be 1–100');
  for (let index = 0; index < items.length; index += size) yield items.slice(index, index + size);
}
