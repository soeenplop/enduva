import type { MeUpdate } from '@enduva/api-client';
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { type FormEvent, useEffect, useState } from 'react';
import { Field, formText, primaryButton, useHydrated } from '../components/form';
import { m } from '../paraglide/messages.js';
import { getLocale, setLocale } from '../paraglide/runtime.js';
import { type Profile, type ProfileSave, updateProfile } from '../profile/functions';
import { profileQuery } from '../profile/queries';
import { viewerQuery } from '../auth/queries';

export const Route = createFileRoute('/profile')({
  beforeLoad: ({ context, location }) => {
    if (context.viewer === null) throw redirect({ to: '/sign-in', search: { redirect: location.href } });
  },
  // Always asks again on entering: a cached profile may belong to a session that was revoked, or to another account.
  loader: async ({ context, location }) => {
    const profile = await context.queryClient.fetchQuery({ ...profileQuery, staleTime: 0 });
    if (profile === null) {
      // The API refused the session and the server dropped it. The cached viewer must go too, or /sign-in would
      // send the browser straight back here.
      context.queryClient.setQueryData(viewerQuery.queryKey, null);
      context.queryClient.removeQueries({ queryKey: profileQuery.queryKey });
      throw redirect({ to: '/sign-in', search: { redirect: location.href } });
    }
    // Another tab signed in as someone else: the header follows the account this page now shows.
    if (profile.me.id !== context.viewer?.id)
      context.queryClient.setQueryData(viewerQuery.queryKey, () => ({ id: profile.me.id, email: profile.email }));
  },
  head: () => ({ meta: [{ title: `${m.profile_title()} · ${m.meta_title()}` }] }),
  component: ProfilePage,
});

const select = 'min-w-0 rounded-md border border-border bg-surface px-3 py-2';

/** Only the fields the form changed; an emptied optional field becomes null (cleared). */
function changes(form: FormData, me: Profile['me']): MeUpdate {
  const text = (name: string) => formText(form, name).trim();
  const optional = (name: string) => text(name) || null;
  const height = text('heightCm');
  const next = {
    displayName: optional('displayName'),
    birthDate: optional('birthDate'),
    sex: optional('sex') as MeUpdate['sex'],
    heightCm: height === '' ? null : Number(height),
    locale: text('locale') as MeUpdate['locale'],
    timeZone: text('timeZone'),
  };
  return Object.fromEntries(Object.entries(next).filter(([key, value]) => me[key as keyof typeof next] !== value));
}

function ProfilePage() {
  const profile = useSuspenseQuery(profileQuery).data;
  // A later refetch (focus, reconnect) found the session gone.
  return profile === null ? <SignedOut /> : <ProfileForm profile={profile} />;
}

/** A document load, so no router or query state of the old session survives. */
function SignedOut() {
  useEffect(() => window.location.assign('/sign-in?redirect=%2Fprofile'), []);
  return null;
}

function ProfileForm({ profile }: Readonly<{ profile: Profile }>) {
  const queryClient = useQueryClient();
  const { data: viewer } = useQuery(viewerQuery);
  // A refetch brought another account's profile (another tab signed in): the header follows it.
  useEffect(() => {
    if (viewer?.id !== profile.me.id)
      queryClient.setQueryData(viewerQuery.queryKey, () => ({ id: profile.me.id, email: profile.email }));
  }, [queryClient, viewer?.id, profile]);
  const hydrated = useHydrated();
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<'saved' | 'conflict' | 'invalid' | 'unavailable'>();

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const patch = changes(new FormData(event.currentTarget), profile.me);
    if (Object.keys(patch).length === 0) return setStatus('saved');
    setPending(true);
    const saved = await updateProfile({ data: { userId: profile.me.id, etag: profile.etag, patch } }).catch(
      (): ProfileSave => ({
        ok: false,
        error: 'unavailable',
      }),
    );
    setPending(false);
    if (!saved.ok && saved.error === 'signed_out') return window.location.assign('/sign-in?redirect=%2Fprofile');
    // This browser is signed in as another account now: nothing was saved; show that account's page.
    if (!saved.ok && saved.error === 'account_changed') return window.location.reload();
    const latest = 'profile' in saved ? saved.profile : undefined;
    if (latest !== undefined) queryClient.setQueryData(profileQuery.queryKey, latest);
    setStatus(saved.ok ? 'saved' : saved.error);
    // A changed language takes effect at once: the locale cookie is set and the page reloads.
    if (saved.ok && patch.locale !== undefined && patch.locale !== getLocale()) void setLocale(patch.locale);
  }

  const { me } = profile;
  const message = {
    conflict: m.profile_error_conflict,
    invalid: m.profile_error_invalid,
    unavailable: m.profile_error_unavailable,
  };
  return (
    <section aria-labelledby="profile-title" className="flex max-w-md flex-col gap-6">
      <h1 id="profile-title" className="text-heading font-extrabold">
        {m.profile_title()}
      </h1>
      <p className="break-words text-muted">{profile.email}</p>
      {/* Keyed by version: after a conflict the form shows the latest profile. */}
      {/* POST, and Save stays disabled until the page runs: personal fields never end up in a URL. */}
      <form key={profile.etag} method="post" className="flex flex-col gap-4" onSubmit={(event) => void save(event)}>
        <Field
          label={m.profile_display_name()}
          name="displayName"
          defaultValue={me.displayName ?? ''}
          maxLength={100}
        />
        <Field label={m.profile_birth_date()} name="birthDate" type="date" defaultValue={me.birthDate ?? ''} />
        <Field
          label={m.profile_sex()}
          control={(id) => (
            <select id={id} name="sex" defaultValue={me.sex ?? ''} className={select}>
              <option value="">{m.profile_sex_unset()}</option>
              <option value="female">{m.profile_sex_female()}</option>
              <option value="male">{m.profile_sex_male()}</option>
            </select>
          )}
        />
        <Field
          label={m.profile_height()}
          name="heightCm"
          type="number"
          inputMode="decimal"
          min={50}
          max={300}
          step="any"
          defaultValue={me.heightCm ?? ''}
        />
        <Field
          label={m.profile_locale()}
          control={(id) => (
            <select id={id} name="locale" defaultValue={me.locale} className={select}>
              <option value="de">{m.language_name({}, { locale: 'de' })}</option>
              <option value="en">{m.language_name({}, { locale: 'en' })}</option>
            </select>
          )}
        />
        <Field
          label={m.profile_time_zone()}
          hint={m.profile_time_zone_hint()}
          name="timeZone"
          defaultValue={me.timeZone}
          autoComplete="off"
          spellCheck={false}
          required
        />
        {status === 'saved' && (
          <p role="status" className="text-success">
            {m.profile_saved()}
          </p>
        )}
        {status !== undefined && status !== 'saved' && (
          <p role="alert" className="text-danger">
            {message[status]()}
          </p>
        )}
        <button type="submit" className={`${primaryButton} self-start`} disabled={!hydrated || pending}>
          {m.profile_save()}
        </button>
      </form>
    </section>
  );
}
