import { signInWithMicrosoft } from "./actions";

const ERRORS: Record<string, string> = {
  oauth: "Sign-in failed. Please try again.",
  not_allowed:
    "That Microsoft account isn't authorised for Evelyn Ops. Use your @urbangymgroup.com account.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const safeNext = next && next.startsWith("/") ? next : "/dashboard";

  return (
    <div className="login-wrap">
      <div className="login-card">
        <h1>Evelyn Ops</h1>
        <p>Sign in with your Urban Gym Group Microsoft account.</p>
        <form action={signInWithMicrosoft}>
          <input type="hidden" name="next" value={safeNext} />
          <button type="submit">Sign in with Microsoft</button>
        </form>
        {error && <div className="error">{ERRORS[error] ?? "Sign-in error."}</div>}
      </div>
    </div>
  );
}
