declare module 'papaparse' {
  interface ParseResult<T> { data: T[] }
  interface ParseError { message: string }
  const Papa: {
    parse<T>(file: File, config: {
      header: true;
      skipEmptyLines: true;
      complete: (result: ParseResult<T>) => void;
      error: (error: ParseError) => void;
    }): void;
  };
  export default Papa;
}
