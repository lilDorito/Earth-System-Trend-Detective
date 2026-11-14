// 404 page

import { Link } from "react-router";

export default function NotFoundPage() {
  return (
    <div className="grid h-full place-items-center p-6">
      <div className="max-w-sm space-y-2 text-center">
        <p className="font-mono text-sm text-muted-foreground">404</p>
        <h1 className="text-lg font-semibold">This page is not on the map</h1>
        <Link to="/" className="inline-block text-sm text-primary underline-offset-4 hover:underline">
          Back to the explorer
        </Link>
      </div>
    </div>
  );
}
