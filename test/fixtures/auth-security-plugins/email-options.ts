import {
  requireWritableAuthCtx,
  type CreateBetterConvexAuthOptions,
} from '@lupinum/better-convex-nuxt/better-auth/server'
import type { GenericDataModel } from 'convex/server'

const options: CreateBetterConvexAuthOptions<GenericDataModel> = {
  emailAndPassword: (ctx) => ({
    revokeSessionsOnPasswordReset: true,
    async sendResetPassword({ user, url }, request) {
      const recipient: string = user.email
      const resetUrl: string = url
      void [recipient, resetUrl, request]
      // @ts-expect-error A query context does not provide writes.
      void ctx.runMutation
      requireWritableAuthCtx(ctx)
      void ctx.runMutation
    },
  }),
  emailVerification: async (ctx) => ({
    expiresIn: 300,
    async sendVerificationEmail({ user, url }) {
      const email: string = user.email
      const verificationUrl: string = url
      requireWritableAuthCtx(ctx)
      void [email, verificationUrl, ctx.runMutation]
    },
  }),
  emailOTP: (ctx) => ({
    expiresIn: 300,
    async sendVerificationOTP({ email, otp, type }) {
      const recipient: string = email
      const code: string = otp
      requireWritableAuthCtx(ctx)
      void [recipient, code, type, ctx.runMutation]
    },
  }),
}

void options
