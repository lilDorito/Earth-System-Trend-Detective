import { Link } from "react-router";

export default function NotFoundPage() {
  return (
    <div className="p-6">
      Nothing here. <Link to="/" className="underline">Back to the globe</Link>
    </div>
  );
}
