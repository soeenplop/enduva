import { createFileRoute } from '@tanstack/react-router';
import { placeholderRoute } from '../components/PlaceholderPage';
import { m } from '../paraglide/messages.js';

export const Route = createFileRoute('/disclaimer')(placeholderRoute(() => m.page_disclaimer(), 'G1.1'));
