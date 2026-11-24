declare namespace paper {
  interface PathItem {
    offset(
      distance: number,
      options?: {
        join?: 'miter' | 'round' | 'bevel';
        miterLimit?: number;
        insert?: boolean;
      }
    ): PathItem;
    outline(options?: {
      width?: number;
      join?: 'miter' | 'round' | 'bevel';
      cap?: 'butt' | 'round' | 'square';
      miterLimit?: number;
      insert?: boolean;
    }): PathItem;
  }

  interface PointText {
    tracking?: number;
  }
}

declare module 'paper/dist/paper-core' {
  import paper from 'paper';
  export default paper;
}
