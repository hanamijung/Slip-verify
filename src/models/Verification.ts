import mongoose, { Schema, Document } from "mongoose";

export interface IVerification extends Document {
  userId: string;
  username: string;
  guildId?: string;
  channelId?: string;
  expectedAmount: number;
  detectedAmount?: number;
  status: "verified" | "rejected" | "error";
  ref?: string;
  senderName?: string;
  receiverName?: string;
  senderBank?: string;
  receiverBank?: string;
  errorSlug?: string;
  errorMessage?: string;
  imageUrl?: string;
  createdAt: Date;
}

const VerificationSchema = new Schema<IVerification>(
  {
    userId: { type: String, required: true, index: true },
    username: { type: String, required: true },
    guildId: { type: String },
    channelId: { type: String },
    expectedAmount: { type: Number, required: true },
    detectedAmount: { type: Number },
    status: {
      type: String,
      enum: ["verified", "rejected", "error"],
      default: "error",
    },
    ref: { type: String },
    senderName: { type: String },
    receiverName: { type: String },
    senderBank: { type: String },
    receiverBank: { type: String },
    errorSlug: { type: String },
    errorMessage: { type: String },
    imageUrl: { type: String },
  },
  { timestamps: true }
);

export const Verification = mongoose.model<IVerification>(
  "Verification",
  VerificationSchema
);
