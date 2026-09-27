import type {
  BetterConvexAuthEmail,
  CreateBetterConvexAuthOptions,
} from '@lupinum/better-convex-nuxt/better-auth/server'
import type { GenericDataModel } from 'convex/server'

function deliver(message: BetterConvexAuthEmail): string {
  switch (message.type) {
    case 'verify-email':
    case 'reset-password':
      return `${message.to} ${message.url} ${message.token} ${message.user.id}`
    case 'email-otp':
      return `${message.to} ${message.otp} ${message.purpose}`
    case 'two-factor-otp':
      return `${message.to} ${message.otp} ${message.user.email}`
    case 'organization-invitation':
      return `${message.to} ${message.invitationId} ${message.organization.name} ${message.inviter.name}`
    default: {
      const exhaustive: never = message
      return exhaustive
    }
  }
}

const options: CreateBetterConvexAuthOptions<GenericDataModel> = {
  async email(ctx, message) {
    // The library guarantees a mutation or action context.
    void ctx.runMutation
    void ctx.scheduler
    // @ts-expect-error `db` exists only on a mutation, so it must be narrowed first.
    void ctx.db
    void deliver(message)
    // @ts-expect-error `otp` is absent on link-based messages until narrowed.
    void message.otp
  },
  emailAndPassword: {
    requireEmailVerification: true,
    passwordReset: true,
    revokeSessionsOnPasswordReset: true,
  },
  emailVerification: { expiresIn: 300, sendOnSignUp: true },
  emailOTP: { expiresIn: 300 },
  session: { expiresIn: 30 * 24 * 60 * 60, updateAge: 60 * 60 },
  account: { accountLinking: { trustedProviders: ['github'] } },
}

const removedPasswordCallback: CreateBetterConvexAuthOptions<GenericDataModel> = {
  emailAndPassword: {
    // @ts-expect-error auth email is delivered only through the typed `email` hook
    async sendResetPassword() {},
  },
}

const removedVerificationCallback: CreateBetterConvexAuthOptions<GenericDataModel> = {
  emailVerification: {
    // @ts-expect-error auth email is delivered only through the typed `email` hook
    async sendVerificationEmail() {},
  },
}

const removedOtpCallback: CreateBetterConvexAuthOptions<GenericDataModel> = {
  emailOTP: {
    // @ts-expect-error auth email is delivered only through the typed `email` hook
    async sendVerificationOTP() {},
  },
}

const removedFactory: CreateBetterConvexAuthOptions<GenericDataModel> = {
  // @ts-expect-error request-scoped option factories were replaced by the `email` hook ctx
  emailAndPassword: () => ({}),
}

void options
void removedPasswordCallback
void removedVerificationCallback
void removedOtpCallback
void removedFactory
