export function EmptyState({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-md border border-dashed p-10 text-center">
      <h2 className="text-lg font-medium">{title}</h2>
      <p className="mt-1 text-muted-foreground">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
