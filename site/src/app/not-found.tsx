import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-4xl font-extrabold tracking-tight">Page not found</h1>
      <p className="text-ink-soft">
        The page you're looking for doesn't exist — but if you have a New
        Jersey house to sell, we're easy to find.
      </p>
      <Link
        href="/"
        className="btn inline-flex items-center justify-center rounded-lg bg-accent px-6 py-3 font-bold text-white transition-colors hover:bg-accent-hover"
      >
        Get a cash offer →
      </Link>
    </div>
  );
}
