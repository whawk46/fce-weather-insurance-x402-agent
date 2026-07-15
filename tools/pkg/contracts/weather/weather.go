//go:generate go run github.com/ethereum/go-ethereum/cmd/abigen --abi=WeatherInsurance.abi --bin=WeatherInsurance.bin --pkg=weather --type=WeatherInsurance --out=autogen.go

package weather
