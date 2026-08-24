import { z } from 'zod';

/**
 * Shared loading machinery for data contracts.
 *
 * DATA-CONTRACTS.md: "Data that no schema validates is not data, it is a future bug." Every JSON
 * file passes through here, so a malformed field fails loudly at load with the path named, rather
 * than producing a subtly wrong game three systems downstream.
 */

export class DataValidationError extends Error {
  constructor(
    readonly file: string,
    readonly issues: readonly z.ZodIssue[],
  ) {
    const detail = issues
      .map((issue) => `  ${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('\n');
    super(`Invalid data in ${file}:\n${detail}`);
    this.name = 'DataValidationError';
  }
}

/** Parse raw JSON through a schema, or throw a DataValidationError naming the file and field. */
export function parseData<T extends z.ZodTypeAny>(
  file: string,
  schema: T,
  raw: unknown,
): z.infer<T> {
  const result = schema.safeParse(raw);
  if (!result.success) throw new DataValidationError(file, result.error.issues);
  return result.data;
}

/** An identifier in a data file: lowercase kebab-case, stable forever once shipped. */
export const IdSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'ids are lowercase kebab-case');

export const NormalisedSchema = z.number().min(0).max(1);
export const PositiveSchema = z.number().positive();
export const NonNegativeSchema = z.number().min(0);
