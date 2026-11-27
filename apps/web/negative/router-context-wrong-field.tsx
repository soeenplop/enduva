// @expect TS2551 at 6:45
import { createFileRoute } from '@tanstack/react-router';

// The router context (RouterContext) has `queryClient`, not `queryclient`.
export const Route = createFileRoute('/')({
  beforeLoad: ({ context }) => void context.queryclient,
});
