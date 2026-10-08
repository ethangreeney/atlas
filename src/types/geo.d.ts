// Just the parts of d3-geo and topojson-client the find-on-map engine uses.
declare module 'd3-geo' {
  type Point = [number, number]
  export interface GeoStream {
    point(x: number, y: number, z?: number): void
    lineStart(): void
    lineEnd(): void
    polygonStart(): void
    polygonEnd(): void
    sphere?(): void
  }
  export interface GeoProjection {
    (point: Point): Point | null
    invert?(point: Point): Point | null
    stream(stream: GeoStream): GeoStream
    rotate(angles: Point): this
    scale(scale: number): this
    translate(translate: Point): this
    precision(precision: number): this
    clipExtent(extent: [Point, Point]): this
  }
  export function geoProjection(raw: ((lambda: number, phi: number) => Point) & { invert?: (x: number, y: number) => Point }): GeoProjection
  export function geoPath(projection?: { stream(stream: GeoStream): GeoStream } | null, context?: unknown): (object: unknown) => unknown
  export function geoArea(object: unknown): number
  export function geoBounds(object: unknown): [Point, Point]
  export function geoCentroid(object: unknown): Point
  export function geoContains(object: unknown, point: Point): boolean
  export function geoDistance(a: Point, b: Point): number
}
declare module 'topojson-client' {
  export function feature(topology: unknown, object: unknown): unknown
}
