import { useEffect, useState } from 'react';
import { Image, Platform, type ImageStyle, type StyleProp } from 'react-native';
import { imageUrl, type Server } from './api';

/** An image from the bridge, fetched with the token. */
export function AuthImage({ server, path, style }: { server: Server; path: string; style: StyleProp<ImageStyle> }) {
  const uri = imageUrl(server, path);
  const headers = { Authorization: `Bearer ${server.token}` };
  // The web preview cannot send headers with <img>, so fetch the bytes first.
  const [webUri, setWebUri] = useState<string | null>(null);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let url: string | null = null;
    fetch(uri, { headers })
      .then((res) => res.blob())
      .then((blob) => {
        url = URL.createObjectURL(blob);
        setWebUri(url);
      })
      .catch(() => {});
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [uri]);

  if (Platform.OS === 'web') return webUri ? <Image source={{ uri: webUri }} style={style} /> : null;
  return <Image source={{ uri, headers }} style={style} />;
}
