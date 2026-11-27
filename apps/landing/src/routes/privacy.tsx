import { createFileRoute } from '@tanstack/react-router';
import { placeholderRoute } from '../components/PlaceholderPage';
import { m } from '../paraglide/messages.js';

export const Route = createFileRoute('/privacy')(placeholderRoute(() => m.page_privacy(), 'G1.1'));
