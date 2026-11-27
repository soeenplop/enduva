import { createFileRoute } from '@tanstack/react-router';
import { placeholderRoute } from '../components/PlaceholderPage';
import { m } from '../paraglide/messages.js';

export const Route = createFileRoute('/disclaimer')(
  placeholderRoute('/disclaimer/', () => m.page_disclaimer(), 'G1.1'),
);
