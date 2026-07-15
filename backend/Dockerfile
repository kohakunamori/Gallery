# Gallery API (Slim) + upload worker (Python)
FROM php:8.3-apache-bookworm

ENV APACHE_DOCUMENT_ROOT=/var/www/gallery/backend/public \
    PHOTO_CATALOG_PATH=/var/www/gallery/backend/var/photos-index.json \
    UPLOAD_TEMPORARY_DIRECTORY=/var/www/gallery/backend/var/upload-batches \
    COMPOSER_ALLOW_SUPERUSER=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git \
        unzip \
        libzip-dev \
        python3 \
        python3-pip \
        python3-venv \
        imagemagick \
        curl \
        ca-certificates \
    && docker-php-ext-install exif \
    && a2enmod rewrite headers \
    && rm -rf /var/lib/apt/lists/*

# Optional PNG optimizer used by upload_r2.py when compression=png
RUN curl -fsSL "https://github.com/oxipng/oxipng/releases/download/v9.1.5/oxipng-9.1.5-x86_64-unknown-linux-gnu.tar.gz" \
    | tar -xz -C /tmp \
    && mv /tmp/oxipng-9.1.5-x86_64-unknown-linux-gnu/oxipng /usr/local/bin/oxipng \
    && chmod +x /usr/local/bin/oxipng \
    && rm -rf /tmp/oxipng-9.1.5-x86_64-unknown-linux-gnu

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

WORKDIR /var/www/gallery

# Install Python upload dependencies into an isolated venv
COPY script/requirements-runtime.txt /tmp/requirements-runtime.txt
RUN python3 -m venv /opt/gallery-python \
    && /opt/gallery-python/bin/pip install --no-cache-dir -r /tmp/requirements-runtime.txt \
    && rm /tmp/requirements-runtime.txt
ENV PATH="/opt/gallery-python/bin:${PATH}" \
    UPLOAD_PYTHON_BINARY=/opt/gallery-python/bin/python

# App source (backend + upload script only)
COPY backend /var/www/gallery/backend
COPY script/upload_r2.py /var/www/gallery/script/upload_r2.py
COPY script/requirements-runtime.txt /var/www/gallery/script/requirements-runtime.txt

WORKDIR /var/www/gallery/backend
RUN composer install --no-dev --prefer-dist --no-interaction --optimize-autoloader \
    && mkdir -p var/cache var/upload-batches \
    && if [ ! -f var/photos-index.json ]; then \
         printf '%s\n' '{"version":1,"updatedAt":"1970-01-01T00:00:00Z","items":[]}' > var/photos-index.json; \
       fi \
    && chown -R www-data:www-data var

# Apache: serve Slim public/ and route everything through index.php
RUN sed -ri -e 's!/var/www/html!${APACHE_DOCUMENT_ROOT}!g' /etc/apache2/sites-available/*.conf \
    && sed -ri -e 's!/var/www/!${APACHE_DOCUMENT_ROOT}!g' /etc/apache2/apache2.conf /etc/apache2/conf-available/*.conf \
    && printf '%s\n' \
        '<Directory /var/www/gallery/backend/public>' \
        '    AllowOverride All' \
        '    Require all granted' \
        '    FallbackResource /index.php' \
        '</Directory>' \
        > /etc/apache2/conf-available/gallery.conf \
    && a2enconf gallery

# Allow long-running uploads / large bodies
RUN printf '%s\n' \
        'upload_max_filesize = 64M' \
        'post_max_size = 320M' \
        'max_execution_time = 900' \
        'max_input_time = 900' \
        'memory_limit = 512M' \
        > /usr/local/etc/php/conf.d/gallery-upload.ini

COPY backend/docker/apache-ports.conf /etc/apache2/ports.conf
COPY backend/docker/000-default.conf /etc/apache2/sites-available/000-default.conf
COPY backend/docker/entrypoint.sh /usr/local/bin/gallery-entrypoint.sh
RUN chmod +x /usr/local/bin/gallery-entrypoint.sh

EXPOSE 8080

VOLUME ["/var/www/gallery/backend/var"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8080/health || exit 1

ENTRYPOINT ["/usr/local/bin/gallery-entrypoint.sh"]
CMD ["apache2-foreground"]
