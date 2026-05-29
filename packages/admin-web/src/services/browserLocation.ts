export async function getBrowserLocation() {
  if (!("geolocation" in navigator)) {
    return null;
  }

  return await new Promise<{ latitude: number; longitude: number; accuracy: number | null } | null>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy ?? null
        }),
      () => resolve(null),
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      }
    );
  });
}
