export interface PompisteJwtPayload {
  sub: string; // Attendant.id
  stationId: string;
  type: "POMPISTE";
}
