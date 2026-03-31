import { describe, expect, it } from 'vitest';
import { groupPhotosByDate } from './groupPhotosByDate';

const photos = [
  {
    id: 'today',
    filename: 'today.jpg',
    url: '/media/today.jpg',
    thumbnailUrl: '/media/today.jpg',
    takenAt: '2026-03-31T09:00:00+00:00',
    sortTime: '2026-03-31T09:00:00+00:00',
    width: 100,
    height: 100,
  },
  {
    id: 'yesterday',
    filename: 'yesterday.jpg',
    url: '/media/yesterday.jpg',
    thumbnailUrl: '/media/yesterday.jpg',
    takenAt: '2026-03-30T11:00:00+00:00',
    sortTime: '2026-03-30T11:00:00+00:00',
    width: 100,
    height: 100,
  },
  {
    id: 'older',
    filename: 'older.jpg',
    url: '/media/older.jpg',
    thumbnailUrl: '/media/older.jpg',
    takenAt: '2026-03-28T08:00:00+00:00',
    sortTime: '2026-03-28T08:00:00+00:00',
    width: 100,
    height: 100,
  },
];

describe('groupPhotosByDate', () => {
  it('creates Today, Yesterday, and formatted older sections', () => {
    const groups = groupPhotosByDate(photos, new Date('2026-03-31T12:00:00+00:00'));

    expect(groups.map((group) => group.title)).toEqual(['Today', 'Yesterday', 'Mar 28, 2026']);
    expect(groups[0].photos).toHaveLength(1);
    expect(groups[1].photos).toHaveLength(1);
    expect(groups[2].photos).toHaveLength(1);
  });
});
