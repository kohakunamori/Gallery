export type Photo = {
  id: string;
  filename: string;
  url: string;
  thumbnailUrl: string;
  takenAt: string | null;
  sortTime: string;
  width: number | null;
  height: number | null;
};
