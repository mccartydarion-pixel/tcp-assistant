import type { QueuedAnnouncement } from './announcementQueue.js';

/**
 * Announcements written in code. On every start the bot posts each entry that is `ready: true`, has never
 * been posted and is at most 14 days old, oldest first, to ANNOUNCEMENT_CHANNEL_ID. See "Queued
 * announcements" in the README for how to add one.
 *
 * Never change an entry's `id` once it has been posted: the id is how the bot knows it already posted it.
 */
export const ANNOUNCEMENT_QUEUE: QueuedAnnouncement[] = [
  {
    // Internal example of the shape. It is a draft (ready: false), so it is never posted.
    id: '0000-example',
    date: '2026-10-20',
    ready: false,
    title: 'T.C.P update: example title',
    description: 'What is new, in a sentence or two. **Bold** and line breaks work.',
    fields: [
      { name: 'Version', value: '1.0', inline: true },
      { name: 'Get it', value: 'Download it in the downloads channel.', inline: true },
    ],
    gif: 'example.gif',
    ping: 'none',
  },
];
