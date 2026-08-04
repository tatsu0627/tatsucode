export function ErrorState({ message }: { message: string }) {
  return <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{message}</div>;
}
