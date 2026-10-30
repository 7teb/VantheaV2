import { remote_client } from "./bridge.ts";
import { remote_media_url } from "./remote-local.ts";

export type MediaBucket = "attachment" | "image" | "favicon";

export const media_url = (bucket: MediaBucket, id: string) => (remote_client ? remote_media_url(bucket, id) : `vx-media://${bucket}/${encodeURIComponent(id)}`);
