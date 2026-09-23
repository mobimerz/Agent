import mongoose, { type FlattenMaps, type Model, type Types } from "mongoose";

/**
 * Reuse an already-compiled model (Next.js dev hot reload re-evaluates modules)
 * while keeping the precise type inferred from `create`.
 */
export function defineModel<T extends () => Model<any>>(name: string, create: T): ReturnType<T> {
  return (mongoose.models[name] as ReturnType<T> | undefined) ?? (create() as ReturnType<T>);
}

/** Shape of a `.lean()` document: Maps flattened to plain objects, plus `_id`. */
export type Lean<T> = FlattenMaps<T> & { _id: Types.ObjectId };

export const DAY_SECONDS = 24 * 60 * 60;
