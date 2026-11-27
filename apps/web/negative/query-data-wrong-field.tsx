// @expect TS2551 at 7:59
import { useSuspenseQuery } from '@tanstack/react-query';
import { apiStatusQuery } from '../src/api/queries';

export function Page() {
  // The query data comes from the server function's return type: `database`, not `databases`.
  return <p>{String(useSuspenseQuery(apiStatusQuery).data.databases)}</p>;
}
