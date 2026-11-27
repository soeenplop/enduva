import { createFileRoute } from '@tanstack/react-router';
import { placeholderRoute } from '../components/PlaceholderPage';
import { m } from '../paraglide/messages.js';

export const Route = createFileRoute('/data-sources')(placeholderRoute(() => m.page_data_sources(), 'G1.2'));
