import { createFileRoute } from '@tanstack/react-router';
import { placeholderRoute } from '../components/PlaceholderPage';
import { m } from '../paraglide/messages.js';

export const Route = createFileRoute('/imprint')(placeholderRoute('/imprint/', () => m.page_imprint(), 'G1.1'));
