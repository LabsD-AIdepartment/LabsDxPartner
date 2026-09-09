import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import type { Sql, TransactionSql } from 'postgres';
import type { BetterAuthOptions, DBAdapter } from 'better-auth';
import {
  APIError,
  addOAuthServerContext,
  getOAuthState,
  getAuthoritativeSessionFromCtx,
} from 'better-auth/api';
import type { GenericEndpointContext } from '@better-auth/core';
import { z } from 'zod';
import { Provider } from '@/contracts/session';
import { Id } from '@/contracts/common';
import type { IdentityFlowHooks } from './auth';
import { transactionDatabase } from './transaction-auth';
import { FRESH_SESSION_SECONDS } from './policy';
import { subjectDigest } from './revocation';

type Factory = (options: BetterAuthOptions) => DBAdapter;
const Intent = z.object({
  id: z.uuid(),
  provider: Provider,
  purpose: z.enum(['sign-in', 'link']),
  actor_id: Id.nullable(),
  session_id: Id.nullable(),
  start_revision: z.string().regex(/^\d+$/),
});
type IntentValue = z.infer<typeof Intent>;
type BoundAccount = { id: string; userId: string; providerId: string; accountId: string };
const AccountBinding = z.object({
  id: Id,
  userId: Id,
  providerId: Provider,
  accountId: z.string().min(1),
});
class CallbackRollback extends Error {}
type RequestState = {
  callback: boolean;
  provider?: string;
  context?: GenericEndpointContext;
  options?: BetterAuthOptions;
  tx?: TransactionSql;
  adapter?: DBAdapter;
  ready?: Promise<void>;
  done?: Promise<void>;
  decide?: (commit: boolean) => void;
  intent?: IntentValue;
  redirects?: string[];
  validated: boolean;
  validatedUser?: string;
  binding?: BoundAccount;
  completed: boolean;
  failed: boolean;
};
const denied = () =>
  new APIError('FORBIDDEN', { code: 'IDENTITY_FLOW_INVALID', message: 'Restart authentication' });

/** Native OAuth owns protocol verification; this boundary owns post-provider DB atomicity. */
export function createOAuthBoundary(sql: Sql, baseURL: string) {
  const requests = new AsyncLocalStorage<RequestState>();

  async function fresh(tx: TransactionSql, userId: string, sessionId: string) {
    const rows =
      await tx`select s.id from portal_identity.sessions s join portal_identity.users u on u.id = s.user_id
      where s.id = ${sessionId} AND s.user_id = ${userId} AND s.expires_at > clock_timestamp()
      AND s.created_at <= clock_timestamp()
      AND s.created_at > clock_timestamp() - ${FRESH_SESSION_SECONDS} * interval '1 second'
      for share of s,u`;
    if (!rows.length) throw denied();
  }
  async function ensureTransaction(state: RequestState) {
    if (state.ready) return state.ready;
    if (!state.callback || !state.options) throw denied();
    const native = await getOAuthState();
    const intentId = z.uuid().safeParse(native?.serverContext?.labsdIntent);
    if (!native || !intentId.success) throw denied();
    let opened!: () => void, failed!: (error: unknown) => void;
    state.ready = new Promise<void>((resolve, reject) => {
      opened = resolve;
      failed = reject;
    });
    const decision = new Promise<boolean>((resolve) => {
      state.decide = resolve;
    });
    state.done = sql
      .begin(async (tx) => {
        await tx`set local lock_timeout = '5s'`;
        await tx`set local statement_timeout = '10s'`;
        await tx`set local idle_in_transaction_session_timeout = '10s'`;
        await tx`select pg_advisory_xact_lock(981705, 2)`;
        state.tx = tx;
        state.adapter = transactionDatabase(tx)(state.options!);
        const [row] =
          await tx`update portal_identity.oauth_intents set consumed_at = clock_timestamp()
        where id = ${intentId.data} AND consumed_at IS NULL AND expires_at > clock_timestamp()
        returning id,provider,purpose,actor_id,session_id,start_revision::text`;
        const parsed = Intent.safeParse(row);
        if (!parsed.success || parsed.data.provider !== state.provider) throw denied();
        state.intent = parsed.data;
        if ((state.intent.purpose === 'link') !== !!native.link) throw denied();
        if (state.intent.purpose === 'link') {
          if (native.link?.userId !== state.intent.actor_id) throw denied();
          if (!state.context) throw denied();
          const session = await getAuthoritativeSessionFromCtx(state.context);
          if (
            session?.user.id !== state.intent.actor_id ||
            session?.session.id !== state.intent.session_id
          )
            throw denied();
          await fresh(tx, state.intent.actor_id!, state.intent.session_id!);
          await assertUserFence(state, state.intent.actor_id!);
        }
        state.redirects = [native.callbackURL, native.newUserURL]
          .filter((v): v is string => typeof v === 'string')
          .map((url) => new URL(url, baseURL).href);
        opened();
        if (!(await decision)) throw new CallbackRollback();
        if (!state.completed || !state.binding) throw denied();
        if (state.intent.purpose === 'link') {
          const result = {
            requestId: state.intent.id,
            accountId: state.binding.id,
            status: 'complete',
          };
          const details = {
            provider: state.binding.providerId,
            intentId: state.intent.id,
            sessionId: state.intent.session_id,
          };
          const digest = createHash('sha256')
            .update(JSON.stringify(['link', state.intent.id, state.binding.id]))
            .digest('hex');
          await tx`insert into portal_identity.method_audit(id,actor_id,action,target_id,idempotency_key,request_hash,result,details)
          values (${state.intent.id},${state.intent.actor_id!},'link',${state.binding.id},${'oauth:' + state.intent.id},${digest},${JSON.stringify(result)}::text::jsonb,${JSON.stringify(details)}::text::jsonb)`;
        }
      })
      .then(() => undefined);
    // Always observe early DB failures, even before the handler reaches its finalizer.
    void state.done.catch((error) => {
      state.failed = true;
      failed(error);
    });
    return state.ready;
  }
  async function assertUserFence(state: RequestState, userId: string) {
    if (!state.tx || !state.intent) throw denied();
    const rows = await state.tx`select user_id from portal_identity.user_fences
      where user_id = ${userId} AND revision > ${state.intent.start_revision}`;
    if (rows.length) throw denied();
  }
  async function assertBinding(state: RequestState, binding: BoundAccount) {
    if (!state.tx || !state.intent || binding.providerId !== state.intent.provider) throw denied();
    if (state.intent.purpose === 'link' && binding.userId !== state.intent.actor_id) throw denied();
    if (state.validatedUser && state.validatedUser !== binding.userId) throw denied();
    await assertUserFence(state, binding.userId);
    const rows = await state.tx`select subject_digest from portal_identity.subject_fences
      where subject_digest = ${subjectDigest(binding.providerId, binding.accountId)} AND revision > ${state.intent.start_revision}`;
    if (rows.length) throw denied();
  }
  function exactId(args: unknown) {
    const parsed = z
      .object({
        where: z.tuple([
          z.object({ field: z.literal('id'), value: Id, operator: z.literal('eq').optional() }),
        ]),
      })
      .safeParse(args);
    if (!parsed.success) throw denied();
    return parsed.data.where[0].value;
  }
  const hooks: IdentityFlowHooks = {
    async before(ctx) {
      const state = requests.getStore();
      if (ctx.path.startsWith('/callback/')) {
        if (state) state.context = ctx;
        return;
      }
      if (ctx.path !== '/sign-in/social' && ctx.path !== '/link-social') return;
      if (!state) throw denied();
      const provider = Provider.safeParse(ctx.body?.provider);
      if (!provider.success || ctx.body?.idToken) throw denied();
      const purpose = ctx.path === '/link-social' ? 'link' : 'sign-in';
      const proof = purpose === 'link' ? await getAuthoritativeSessionFromCtx(ctx) : null;
      if (purpose === 'link' && !proof) throw denied();
      const id = randomUUID();
      await sql.begin(async (tx) => {
        await tx`set local lock_timeout = '5s'`;
        await tx`set local statement_timeout = '10s'`;
        await tx`select pg_advisory_xact_lock(981705, 2)`;
        if (proof) await fresh(tx, proof.user.id, proof.session.id);
        const [clock] =
          await tx`select revision::text from portal_identity.mutation_clock where id = 'current'`;
        if (!clock) throw denied();
        await tx`insert into portal_identity.oauth_intents(id,provider,purpose,actor_id,session_id,start_revision,expires_at)
          values (${id},${provider.data},${purpose},${proof?.user.id ?? null},${proof?.session.id ?? null},${clock.revision},clock_timestamp() + interval '10 minutes')`;
      });
      await addOAuthServerContext({ labsdIntent: id });
    },
    async validateUserInfo(info) {
      const state = requests.getStore();
      if (
        !state?.callback ||
        info.source.method !== 'oauth' ||
        info.source.oauth?.providerId !== state.provider
      )
        throw denied();
      try {
        await ensureTransaction(state);
        if (state.intent?.purpose === 'link' && info.source.action !== 'link-account')
          throw denied();
        if (typeof info.user.id === 'string') {
          state.validatedUser = info.user.id;
          await assertUserFence(state, info.user.id);
        }
        state.validated = true;
      } catch (error) {
        state.failed = true;
        throw error;
      }
    },
  };
  function database(factory: Factory): Factory {
    return (options) => {
      const base = factory(options);
      return new Proxy(base, {
        get(target, key, receiver) {
          const method = Reflect.get(target, key, receiver);
          if (typeof method !== 'function') return method;
          return async (...args: unknown[]) => {
            const state = requests.getStore();
            if (!state?.callback) return Reflect.apply(method, target, args);
            state.options ??= options;
            try {
              if (key === 'transaction') {
                await ensureTransaction(state);
                const callback = args[0];
                if (typeof callback !== 'function') throw denied();
                // The native library's transaction scope still uses our routed adapter.
                return callback(receiver);
              }
              const input = z.object({ model: z.string() }).passthrough().safeParse(args[0]);
              const writes = [
                'create',
                'update',
                'updateMany',
                'delete',
                'deleteMany',
                'consumeOne',
                'incrementOne',
              ].includes(String(key));
              if (
                writes &&
                input.success &&
                ['account', 'user', 'session'].includes(input.data.model)
              ) {
                await ensureTransaction(state);
                if (!state.validated) throw denied();
                if (!['create', 'update'].includes(String(key))) throw denied();
                if (input.data.model === 'account') {
                  let binding: BoundAccount;
                  if (key === 'create') {
                    const data = z
                      .object({
                        data: AccountBinding.omit({ id: true }).extend({ id: Id.optional() }),
                      })
                      .parse(args[0]).data;
                    binding = { ...data, id: data.id ?? 'pending' };
                  } else {
                    const id = exactId(args[0]);
                    const [row] =
                      await state.tx!`select id,user_id as "userId",provider_id as "providerId",account_id as "accountId"
                      from portal_identity.accounts where id = ${id} for share`;
                    binding = AccountBinding.parse(row);
                  }
                  await assertBinding(state, binding);
                } else if (input.data.model === 'session') {
                  const data = z.object({ data: z.object({ userId: Id }) }).parse(args[0]).data;
                  if (key !== 'create' || !state.binding || state.binding.userId !== data.userId)
                    throw denied();
                  await assertBinding(state, state.binding);
                } else if (key === 'update') {
                  if (exactId(args[0]) !== state.validatedUser) throw denied();
                }
              }
              const adapter = state.adapter ?? target;
              const result = await Reflect.apply(Reflect.get(adapter, key), adapter, args);
              if (writes && input.success && input.data.model === 'account') {
                state.binding = AccountBinding.parse(result);
                await assertBinding(state, state.binding);
                if (state.intent?.purpose === 'link') state.completed = true;
              }
              if (writes && input.success && input.data.model === 'session') state.completed = true;
              return result;
            } catch (error) {
              state.failed = true;
              throw error;
            }
          };
        },
      });
    };
  }
  async function handle(request: Request, native: (request: Request) => Promise<Response>) {
    const path = new URL(request.url).pathname;
    const provider = /^\/api\/auth\/callback\/([^/]+)$/.exec(path)?.[1];
    const state: RequestState = {
      callback: !!provider && request.method === 'GET',
      provider,
      validated: false,
      completed: false,
      failed: false,
    };
    return requests.run(state, async () => {
      try {
        const response = await native(request);
        if (!state.done) return response;
        const location = response.headers.get('location');
        const success =
          !state.failed &&
          state.completed &&
          response.status >= 300 &&
          response.status < 400 &&
          !!location &&
          state.redirects?.includes(new URL(location, baseURL).href);
        state.decide?.(!!success);
        try {
          await state.done;
        } catch (error) {
          if (!(error instanceof CallbackRollback)) throw error;
          if (!state.failed && state.completed) throw denied();
        }
        return response;
      } catch (error) {
        state.decide?.(false);
        if (state.done) await state.done.catch(() => {});
        throw error;
      }
    });
  }
  return { hooks, database, handle };
}
