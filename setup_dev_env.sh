#!/bin/bash

# Define variables
CONTAINER_NAME="homebridge-dev"
HOMEBRIDGE_CONFIG_DIR="$HOME/.homebridge"
HOMEBRIDGE_PLUGIN_DIR="$HOME/homebridge-plugins"
PLUGIN_NAME="homebridge-sony-adcp-projector"
PLUGIN_REPO="https://github.com/steven-ward/Homebridge-Sony-ADCP-Projector-Plugin.git"
DOCKER_IMAGE="homebridge/homebridge:latest"

# Function to check if a command exists
command_exists() {
    command -v "$1" &> /dev/null
}

echo "Setting up Homebridge Development Environment on macOS..."

# Ensure Homebrew is installed
if ! command_exists brew; then
    echo "Homebrew not found. Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
else
    echo "Homebrew is already installed."
fi

# Ensure Docker is installed
if ! command_exists docker; then
    echo "Docker is not installed. Installing Docker..."
    brew install --cask docker
    open -a Docker  # Start Docker.app
    echo "Please wait for Docker to start before continuing..."
    sleep 10
else
    echo "Docker is already installed."
fi

# Create necessary directories
mkdir -p "$HOMEBRIDGE_CONFIG_DIR"
mkdir -p "$HOMEBRIDGE_PLUGIN_DIR"

# Clone the plugin repository (if not already cloned)
if [ ! -d "$HOMEBRIDGE_PLUGIN_DIR/$PLUGIN_NAME" ]; then
    echo "Cloning plugin repository..."
    git clone "$PLUGIN_REPO" "$HOMEBRIDGE_PLUGIN_DIR/$PLUGIN_NAME"
else
    echo "Plugin repository already exists. Pulling latest changes..."
    cd "$HOMEBRIDGE_PLUGIN_DIR/$PLUGIN_NAME"
    git pull origin main
fi

# Build plugin dependencies
echo "Installing dependencies for the plugin..."
cd "$HOMEBRIDGE_PLUGIN_DIR/$PLUGIN_NAME"
npm install
npm link

# Stop and remove any existing Homebridge container
if docker ps -q -f name=$CONTAINER_NAME; then
    echo "Stopping existing Homebridge container..."
    docker stop "$CONTAINER_NAME"
fi

if docker ps -aq -f name=$CONTAINER_NAME; then
    echo "Removing existing Homebridge container..."
    docker rm "$CONTAINER_NAME"
fi

# Run Homebridge in Docker with volume mapping
echo "Starting Homebridge container in development mode..."
docker run -d \
    --name "$CONTAINER_NAME" \
    --restart unless-stopped \
    -p 8581:8581 \
    -p 51826:51826 \
    -v "$HOMEBRIDGE_CONFIG_DIR:/homebridge" \
    -v "$HOMEBRIDGE_PLUGIN_DIR/$PLUGIN_NAME:/homebridge/node_modules/$PLUGIN_NAME" \
    -e TZ=$(systemsetup -gettimezone | awk '{print $3}') \
    "$DOCKER_IMAGE"

# Wait for Homebridge to initialize
sleep 5
echo "Homebridge is running in Docker with the Sony ADCP Projector Plugin."
echo "Access the Homebridge UI at: http://localhost:8581"

# Provide restart instructions
echo "To restart Homebridge after making changes to your plugin, run:"
echo "docker restart $CONTAINER_NAME"

# Display logs
echo "To view Homebridge logs, use:"
echo "docker logs -f $CONTAINER_NAME"