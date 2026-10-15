<?php

declare(strict_types=1);

namespace Gallery\Http;

use Generator;
use Psr\Http\Message\StreamInterface;
use RuntimeException;

final class CallbackStream implements StreamInterface
{
    private ?Generator $generator = null;
    private string $buffer = '';
    private bool $eof = false;

    /**
     * @param callable():Generator<int,string> $factory
     */
    public function __construct(private readonly mixed $factory)
    {
    }

    public function __toString(): string
    {
        try {
            return $this->getContents();
        } catch (RuntimeException) {
            return '';
        }
    }

    public function close(): void
    {
        $this->detach();
    }

    public function detach(): mixed
    {
        $this->generator = null;
        $this->buffer = '';
        $this->eof = true;

        return null;
    }

    public function getSize(): ?int
    {
        return null;
    }

    public function tell(): int
    {
        throw new RuntimeException('Stream position is unavailable.');
    }

    public function eof(): bool
    {
        return $this->eof && $this->buffer === '';
    }

    public function isSeekable(): bool
    {
        return false;
    }

    public function seek(int $offset, int $whence = SEEK_SET): void
    {
        throw new RuntimeException('Stream is not seekable.');
    }

    public function rewind(): void
    {
        throw new RuntimeException('Stream is not seekable.');
    }

    public function isWritable(): bool
    {
        return false;
    }

    public function write(string $string): int
    {
        throw new RuntimeException('Stream is not writable.');
    }

    public function isReadable(): bool
    {
        return true;
    }

    public function read(int $length): string
    {
        if ($length <= 0) {
            return '';
        }

        if ($this->buffer === '' && !$this->eof) {
            $this->pullNextChunk();
        }

        $chunk = substr($this->buffer, 0, $length);
        $this->buffer = substr($this->buffer, strlen($chunk));

        return $chunk;
    }

    public function getContents(): string
    {
        while (!$this->eof) {
            $this->pullNextChunk();
        }

        $contents = $this->buffer;
        $this->buffer = '';

        return $contents;
    }

    public function getMetadata(?string $key = null): mixed
    {
        $metadata = [];

        return $key === null ? $metadata : ($metadata[$key] ?? null);
    }

    private function pullNextChunk(): void
    {
        $generator = $this->generator();

        if (!$generator->valid()) {
            $this->eof = true;

            return;
        }

        $chunk = $generator->current();
        $generator->next();
        $this->buffer .= $chunk;
    }

    private function generator(): Generator
    {
        if ($this->generator === null) {
            $factory = $this->factory;
            $this->generator = $factory();
        }

        return $this->generator;
    }
}
