import { Schema, model, type InferSchemaType } from "mongoose";
import { defineModel, type Lean } from "../model-utils";

/** While a window is active, checks still run and are recorded but never alert. */
const maintenanceWindowSchema = new Schema(
  {
    siteId: { type: Schema.Types.ObjectId, ref: "Site", required: true },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    reason: { type: String, default: "" },
    createdBy: String,
  },
  { timestamps: true, collection: "maintenanceWindows" },
);

maintenanceWindowSchema.index({ siteId: 1, startsAt: 1, endsAt: 1 });
maintenanceWindowSchema.index({ endsAt: 1 });

export type MaintenanceWindowDoc = InferSchemaType<typeof maintenanceWindowSchema>;
export type MaintenanceWindowLean = Lean<MaintenanceWindowDoc>;

export const MaintenanceWindow = defineModel("MaintenanceWindow", () =>
  model("MaintenanceWindow", maintenanceWindowSchema),
);
